#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>

#if __has_include("VisionCameraFaceLandmarks/VisionCameraFaceLandmarks-Swift.h")
#import "VisionCameraFaceLandmarks/VisionCameraFaceLandmarks-Swift.h"
#else
#import "VisionCameraFaceLandmarks-Swift.h"
#endif

// Plugin ilova yuklanishida (+load) ro'yxatga olinadi — JS keyin
// VisionCameraProxy.initFrameProcessorPlugin('detectFaceLandmarks') bilan oladi.
@interface VisionCameraFaceLandmarks (FrameProcessorPluginLoader)
@end

@implementation VisionCameraFaceLandmarks (FrameProcessorPluginLoader)
+ (void)load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"detectFaceLandmarks"
    withInitializer:^FrameProcessorPlugin* (VisionCameraProxyHolder* proxy, NSDictionary* options) {
    return [[VisionCameraFaceLandmarks alloc] initWithProxy:proxy withOptions:options];
  }];
}
@end

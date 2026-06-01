import {
  sellerTimeoutQueue,
  deliveryTimeoutQueue,
  returnPickupTimeoutQueue,
  JOB_NAMES,
} from "./orderQueues.js";
import {
  processSellerTimeoutJob,
  processDeliveryTimeoutJob,
  processReturnPickupTimeoutJob,
} from "../services/orderWorkflowService.js";
import { isRedisEnabled } from "../config/redis.js";
import logger from "../services/logger.js";
import { incrementCounter, recordHistogram } from "../services/metrics.js";

export function registerOrderQueueProcessors() {
  if (!isRedisEnabled()) {
    logger.info('Redis disabled, skipping queue processor registration');
    return;
  }

  // Seller timeout queue processor
  sellerTimeoutQueue.process(JOB_NAMES.SELLER_TIMEOUT, async (job) => {
    const startTime = Date.now();
    
    try {
      logger.info('Processing seller timeout job', {
        jobId: job.id,
        jobType: JOB_NAMES.SELLER_TIMEOUT,
        orderId: job.data.orderId,
        attempt: job.attemptsMade + 1
      });
      
      await processSellerTimeoutJob(job.data);
      
      const duration = Date.now() - startTime;
      
      logger.info('Seller timeout job completed', {
        jobId: job.id,
        jobType: JOB_NAMES.SELLER_TIMEOUT,
        orderId: job.data.orderId,
        duration
      });
      
      // Collect metrics
      incrementCounter('queue_jobs_total', {
        queue: 'seller-timeout',
        status: 'completed'
      });
      recordHistogram('queue_job_duration_seconds', duration / 1000, {
        queue: 'seller-timeout'
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Seller timeout job failed', {
        jobId: job.id,
        jobType: JOB_NAMES.SELLER_TIMEOUT,
        orderId: job.data.orderId,
        attempt: job.attemptsMade + 1,
        duration,
        error: error.message,
        stack: error.stack
      });
      
      // Collect metrics
      incrementCounter('queue_jobs_total', {
        queue: 'seller-timeout',
        status: 'failed'
      });
      
      throw error; // Re-throw to let Bull handle retry
    }
  });

  // Delivery timeout queue processor
  deliveryTimeoutQueue.process(JOB_NAMES.DELIVERY_TIMEOUT, async (job) => {
    const startTime = Date.now();
    
    try {
      logger.info('Processing delivery timeout job', {
        jobId: job.id,
        jobType: JOB_NAMES.DELIVERY_TIMEOUT,
        orderId: job.data.orderId,
        attempt: job.attemptsMade + 1
      });
      
      await processDeliveryTimeoutJob(job.data);
      
      const duration = Date.now() - startTime;
      
      logger.info('Delivery timeout job completed', {
        jobId: job.id,
        jobType: JOB_NAMES.DELIVERY_TIMEOUT,
        orderId: job.data.orderId,
        duration
      });
      
      // Collect metrics
      incrementCounter('queue_jobs_total', {
        queue: 'delivery-timeout',
        status: 'completed'
      });
      recordHistogram('queue_job_duration_seconds', duration / 1000, {
        queue: 'delivery-timeout'
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Delivery timeout job failed', {
        jobId: job.id,
        jobType: JOB_NAMES.DELIVERY_TIMEOUT,
        orderId: job.data.orderId,
        attempt: job.attemptsMade + 1,
        duration,
        error: error.message,
        stack: error.stack
      });
      
      // Collect metrics
      incrementCounter('queue_jobs_total', {
        queue: 'delivery-timeout',
        status: 'failed'
      });
      
      throw error; // Re-throw to let Bull handle retry
    }
  });

  // Return-pickup timeout queue processor — same shape as delivery timeout.
  returnPickupTimeoutQueue.process(JOB_NAMES.RETURN_PICKUP_TIMEOUT, async (job) => {
    const startTime = Date.now();

    try {
      logger.info('Processing return-pickup timeout job', {
        jobId: job.id,
        jobType: JOB_NAMES.RETURN_PICKUP_TIMEOUT,
        orderId: job.data.orderId,
        attempt: job.attemptsMade + 1,
      });

      await processReturnPickupTimeoutJob(job.data);

      const duration = Date.now() - startTime;

      logger.info('Return-pickup timeout job completed', {
        jobId: job.id,
        jobType: JOB_NAMES.RETURN_PICKUP_TIMEOUT,
        orderId: job.data.orderId,
        duration,
      });

      incrementCounter('queue_jobs_total', {
        queue: 'return-pickup-timeout',
        status: 'completed',
      });
      recordHistogram('queue_job_duration_seconds', duration / 1000, {
        queue: 'return-pickup-timeout',
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Return-pickup timeout job failed', {
        jobId: job.id,
        jobType: JOB_NAMES.RETURN_PICKUP_TIMEOUT,
        orderId: job.data.orderId,
        attempt: job.attemptsMade + 1,
        duration,
        error: error.message,
        stack: error.stack,
      });

      incrementCounter('queue_jobs_total', {
        queue: 'return-pickup-timeout',
        status: 'failed',
      });

      throw error;
    }
  });

  // Queue event handlers
  sellerTimeoutQueue.on("failed", (job, err) => {
    logger.error('Seller timeout queue job failed', {
      jobId: job?.id,
      jobType: JOB_NAMES.SELLER_TIMEOUT,
      orderId: job?.data?.orderId,
      error: err?.message
    });
  });
  
  deliveryTimeoutQueue.on("failed", (job, err) => {
    logger.error('Delivery timeout queue job failed', {
      jobId: job?.id,
      jobType: JOB_NAMES.DELIVERY_TIMEOUT,
      orderId: job?.data?.orderId,
      error: err?.message
    });
  });
  
  sellerTimeoutQueue.on("completed", (job) => {
    logger.debug('Seller timeout queue job completed', {
      jobId: job?.id,
      orderId: job?.data?.orderId
    });
  });
  
  deliveryTimeoutQueue.on("completed", (job) => {
    logger.debug('Delivery timeout queue job completed', {
      jobId: job?.id,
      orderId: job?.data?.orderId
    });
  });

  returnPickupTimeoutQueue.on("failed", (job, err) => {
    logger.error('Return-pickup timeout queue job failed', {
      jobId: job?.id,
      jobType: JOB_NAMES.RETURN_PICKUP_TIMEOUT,
      orderId: job?.data?.orderId,
      error: err?.message,
    });
  });

  returnPickupTimeoutQueue.on("completed", (job) => {
    logger.debug('Return-pickup timeout queue job completed', {
      jobId: job?.id,
      orderId: job?.data?.orderId,
    });
  });

  logger.info('Order queue processors registered', {
    queues: [
      JOB_NAMES.SELLER_TIMEOUT,
      JOB_NAMES.DELIVERY_TIMEOUT,
      JOB_NAMES.RETURN_PICKUP_TIMEOUT,
    ]
  });
}
